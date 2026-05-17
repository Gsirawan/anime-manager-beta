import type { Session } from '../session';
import { parseHeader, REPLY } from '../codes';

export async function fetchAnimeDesc(session: Session, aid: number): Promise<string | null> {
	const chunks: string[] = [];
	let part = 0;
	let maxParts = 1;
	while (part < maxParts) {
		const reply = await session.sendWithSession(`ANIMEDESC aid=${aid}&part=${part}`);
		const h = parseHeader(reply);
		if (h.code === REPLY.NO_DATA) return null;
		if (h.code !== REPLY.ANIME_DESC) throw new Error(`ANIMEDESC failed: ${h.code} ${h.rest}`);
		const body = reply.toString().split('\n')[1] ?? '';
		const m = body.match(/^(\d+)\|(\d+)\|([\s\S]*)$/);
		if (!m) throw new Error(`unparseable ANIMEDESC body: ${body}`);
		maxParts = Number(m[2]);
		chunks.push(m[3]);
		part += 1;
	}
	return chunks.join('');
}
