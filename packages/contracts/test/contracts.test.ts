import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  apiErrorSchema,
  commandAckSchema,
  commandSchema,
  errorCatalog,
  errorCodes,
  missingErrorParams,
  timerStateSchema,
  versionCheckRequestSchema,
  versionCheckResponseSchema,
  workerAuthSchema,
  workerCommandSchema,
} from '../src/index.js';

const UUID_A = '3f2b8c1e-9d4a-4f6b-8c2e-1a2b3c4d5e6f';
const UUID_B = '7c1d2e3f-4a5b-4c6d-9e8f-0a1b2c3d4e5f';

describe('protocol', () => {
  it('has a positive integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('command schemas', () => {
  const valid = { commandId: UUID_A, action: 'next', controlSessionId: UUID_B };

  it('accepts a valid command', () => {
    expect(commandSchema.parse(valid)).toEqual(valid);
  });

  it('rejects unknown actions', () => {
    expect(commandSchema.safeParse({ ...valid, action: 'pause' }).success).toBe(false);
  });

  it('rejects malformed identifiers', () => {
    expect(commandSchema.safeParse({ ...valid, commandId: 'not-a-uuid' }).success).toBe(false);
  });

  it('requires expiresAt on the worker command', () => {
    expect(workerCommandSchema.safeParse(valid).success).toBe(false);
    expect(workerCommandSchema.safeParse({ ...valid, expiresAt: 1763200000000 }).success).toBe(
      true,
    );
  });

  it('validates acknowledgements', () => {
    expect(commandAckSchema.safeParse({ commandId: UUID_A, status: 'executed' }).success).toBe(
      true,
    );
    expect(
      commandAckSchema.safeParse({
        commandId: UUID_A,
        status: 'rejected',
        errorCode: 'command_expired',
      }).success,
    ).toBe(true);
    expect(commandAckSchema.safeParse({ commandId: UUID_A, status: 'pending' }).success).toBe(
      false,
    );
    expect(
      commandAckSchema.safeParse({ commandId: UUID_A, status: 'rejected', errorCode: 'made_up' })
        .success,
    ).toBe(false);
  });
});

describe('worker auth and version check', () => {
  const auth = {
    deviceId: UUID_A,
    credential: 'secret',
    appVersion: '1.0.0',
    os: 'macos',
    arch: 'arm64',
    protocolVersion: PROTOCOL_VERSION,
  };

  it('accepts valid worker auth', () => {
    expect(workerAuthSchema.parse(auth)).toEqual(auth);
  });

  it('rejects empty credentials and unknown platforms', () => {
    expect(workerAuthSchema.safeParse({ ...auth, credential: '' }).success).toBe(false);
    expect(workerAuthSchema.safeParse({ ...auth, os: 'linux' }).success).toBe(false);
    expect(workerAuthSchema.safeParse({ ...auth, arch: 'x86' }).success).toBe(false);
  });

  it('derives the version check request from auth fields', () => {
    const request = versionCheckRequestSchema.parse(auth);
    expect(request).toEqual({
      os: 'macos',
      arch: 'arm64',
      appVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
    });
  });

  it('validates the version check response', () => {
    const response = {
      latestVersion: '1.1.0',
      minSupportedVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      downloadUrl: 'https://github.com/clickerfree/releases/download/v1.1.0/worker-macos-arm64',
      sha256: 'a'.repeat(64),
      descriptionKey: 'releases.v1_1_0.description',
    };
    expect(versionCheckResponseSchema.parse(response)).toEqual(response);
    expect(versionCheckResponseSchema.safeParse({ ...response, sha256: 'abc' }).success).toBe(
      false,
    );
    expect(
      versionCheckResponseSchema.safeParse({ ...response, downloadUrl: 'http://example.com/w' })
        .success,
    ).toBe(false);
    expect(
      versionCheckResponseSchema.safeParse({ ...response, downloadUrl: 'ftp://x' }).success,
    ).toBe(false);
  });
});

describe('timer state', () => {
  it('allows a null endAt and requires server time', () => {
    expect(timerStateSchema.parse({ endAt: null, serverTime: 1763200000000 })).toEqual({
      endAt: null,
      serverTime: 1763200000000,
    });
    expect(timerStateSchema.safeParse({ endAt: 1763200000000 }).success).toBe(false);
  });
});

describe('error catalog', () => {
  it('exposes unique codes', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
    expect(errorCodes.length).toBe(Object.keys(errorCatalog).length);
  });

  it('accepts every catalog code with its declared params', () => {
    for (const code of errorCodes) {
      const params = Object.fromEntries(errorCatalog[code].map((name) => [name, 1]));
      const result = apiErrorSchema.safeParse({ code, params });
      expect(result.success, `code ${code}`).toBe(true);
      expect(missingErrorParams(code, params)).toEqual([]);
    }
  });

  it('detects missing params', () => {
    expect(missingErrorParams('rate_limited', {})).toEqual(['retryAfterSeconds']);
    expect(missingErrorParams('rate_limited', { retryAfterSeconds: 30 })).toEqual([]);
    expect(missingErrorParams('unauthorized', {})).toEqual([]);
  });

  it('rejects unknown codes', () => {
    expect(apiErrorSchema.safeParse({ code: 'made_up', params: {} }).success).toBe(false);
  });
});
