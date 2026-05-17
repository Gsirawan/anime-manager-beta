import { createSocket, type Socket } from 'node:dgram';
import { logger } from '../logger';
import type { RateLimiter } from './rateLimiter';

export interface UdpTransport {
	send(packet: Buffer): Promise<Buffer>;
	close(): Promise<void>;
}

export class DgramTransport implements UdpTransport {
	private sock: Socket;
	private inflight: ((b: Buffer) => void) | null = null;
	// AniDB can be slow under load; docs recommend long timeouts.
	private timeoutMs = 30_000;
	// Resolves once the socket is bound to its local port.
	private ready: Promise<void>;

	constructor(
		private host: string,
		private port: number,
		private rateLimiter?: RateLimiter,
		/**
		 * Local source port. AniDB REQUIRES a fixed port reused across restarts
		 * — "If the API sees too many different UDP Ports from one IP within ~1
		 * hour it will ban the IP" (UDP_API_Definition § Local Port). Use 0 to
		 * fall back to an OS-assigned ephemeral port (testing only).
		 */
		private localPort: number = 0
	) {
		this.sock = createSocket('udp4');
		this.sock.on('message', (msg) => {
			const cb = this.inflight;
			this.inflight = null;
			if (cb) cb(msg);
			else logger.warn({ msg: msg.toString() }, 'udp: unsolicited message');
		});

		this.ready = new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => reject(err);
			this.sock.once('error', onError);
			this.sock.bind(this.localPort, '0.0.0.0', () => {
				this.sock.off('error', onError);
				const addr = this.sock.address();
				if (typeof addr === 'object') {
					logger.info(
						{ localPort: addr.port, remote: `${this.host}:${this.port}` },
						'udp transport bound'
					);
				}
				resolve();
			});
		});
	}

	async send(packet: Buffer): Promise<Buffer> {
		// Wait for socket bind on first call (no-op afterward).
		await this.ready;
		// Apply 2.1s spacing + any ban penalty BEFORE every packet.
		// This is the only correct place: AUTH, command, and INVALID_SESSION retry
		// all funnel through here, so each gets its own slot.
		if (this.rateLimiter) await this.rateLimiter.acquire();
		if (this.inflight) return Promise.reject(new Error('transport busy'));
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.inflight = null;
				reject(new Error('udp timeout'));
			}, this.timeoutMs);
			this.inflight = (msg) => {
				clearTimeout(timer);
				resolve(msg);
			};
			this.sock.send(packet, this.port, this.host, (err) => {
				if (err) {
					clearTimeout(timer);
					this.inflight = null;
					reject(err);
				}
			});
		});
	}

	close(): Promise<void> {
		return new Promise((resolve) => this.sock.close(() => resolve()));
	}
}

export class FakeTransport implements UdpTransport {
	public sent: Buffer[] = [];
	constructor(private responses: Buffer[]) {}
	async send(packet: Buffer): Promise<Buffer> {
		this.sent.push(packet);
		const next = this.responses.shift();
		if (!next) throw new Error('FakeTransport: out of canned responses');
		return next;
	}
	async close(): Promise<void> {}
}
