import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { LogLevel, NodeEnv } from './env.validation.js';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_INCOMING_ID_LENGTH = 100;

/**
 * Structured JSON logs with one request id per request.
 * An incoming x-request-id (e.g. from the web proxy) is reused so one id
 * follows a request across services; otherwise a new UUID is generated.
 */
export function buildLoggerParams(
  nodeEnv: NodeEnv,
  logLevel: LogLevel,
): Params {
  return {
    pinoHttp: {
      level: nodeEnv === NodeEnv.Test ? LogLevel.Silent : logLevel,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id =
          typeof incoming === 'string' &&
          incoming.length <= MAX_INCOMING_ID_LENGTH
            ? incoming
            : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // Session cookies and auth headers must never reach the logs.
      redact: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
      ],
      // Docker and hosting health checks hit /health every few seconds.
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
      transport:
        nodeEnv === NodeEnv.Development
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  };
}
