import { hash, verify } from '@node-rs/argon2';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { AccessTokenClaims, AttemptLimiter, PasswordHasher, SecretGenerator, TokenService } from '../../domain/ports/ports';
import { ROLES, Role } from '../../domain/shared/enums';

/**
 * argon2id en formato PHC con los parámetros por defecto de @node-rs/argon2 (la misma
 * librería y versión que usa sql/tools para el seed, así los hashes son compatibles).
 */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(phc: string, plain: string): Promise<boolean> {
    try {
      return await verify(phc, plain);
    } catch {
      return false;
    }
  }
}

/** Access JWT HS256 (15 min) + refresh opaco aleatorio guardado como sha256. */
export class JwtTokenService implements TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly secret: string,
    private readonly accessTtlSeconds: number,
    private readonly refreshTtlDays: number,
  ) {}

  async signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await this.jwt.signAsync(
      { sub: claims.sub, role: claims.role, mcp: claims.mustChangePassword, typ: 'access' },
      { secret: this.secret, algorithm: 'HS256', expiresIn: this.accessTtlSeconds },
    );
    return { token, expiresIn: this.accessTtlSeconds };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
    try {
      const p = await this.jwt.verifyAsync<{ sub?: unknown; role?: unknown; mcp?: unknown; typ?: unknown }>(token, {
        secret: this.secret,
        algorithms: ['HS256'],
      });
      if (typeof p.sub !== 'string' || p.typ !== 'access' || !ROLES.includes(p.role as Role)) return null;
      return { sub: p.sub, role: p.role as Role, mustChangePassword: p.mcp === true };
    } catch {
      return null;
    }
  }

  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  refreshTokenTtlDays(): number {
    return this.refreshTtlDays;
  }
}

const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

export class CryptoSecretGenerator implements SecretGenerator {
  /** 14 caracteres sin ambiguos (0/O, 1/l/I), con al menos una letra y un número. */
  temporaryPassword(): string {
    const all = LETTERS + DIGITS;
    const chars = [LETTERS[randomInt(LETTERS.length)]!, DIGITS[randomInt(DIGITS.length)]!];
    while (chars.length < 14) chars.push(all[randomInt(all.length)]!);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  }

  uuid(): string {
    return randomUUID();
  }

  /** UUID v5 (SHA-1) en un espacio de nombres propio de la app. */
  uuidFromName(name: string): string {
    const namespace = Buffer.from('6f1c2a8e3b5d4c7f9a0e1d2c3b4a5f60', 'hex');
    const bytes = createHash('sha1').update(namespace).update(name, 'utf8').digest().subarray(0, 16);
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/**
 * Límite de intentos fallidos en memoria (ventana deslizante). 04 §4 regla 6b lo deja a criterio
 * del backend; con varias instancias el límite es por instancia (ver README).
 */
export class InMemoryAttemptLimiter implements AttemptLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private recent(key: string, windowMs: number): number[] {
    const cutoff = this.now() - windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  async isBlocked(key: string, maxAttempts: number, windowMs: number): Promise<boolean> {
    return this.recent(key, windowMs).length >= maxAttempts;
  }

  async registerFailure(key: string, windowMs: number): Promise<void> {
    const list = this.recent(key, windowMs);
    list.push(this.now());
    this.failures.set(key, list);
  }

  async reset(key: string): Promise<void> {
    this.failures.delete(key);
  }
}
