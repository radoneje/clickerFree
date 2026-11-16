import type { FastifyReply } from 'fastify';
import type { ErrorCode, ErrorParams } from '@clickerfree/contracts';

export function sendError<C extends ErrorCode>(
  reply: FastifyReply,
  status: number,
  code: C,
  params: ErrorParams<C>,
): FastifyReply {
  return reply.status(status).send({ error: { code, params } });
}
