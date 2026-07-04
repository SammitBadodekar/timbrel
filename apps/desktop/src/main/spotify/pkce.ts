/** PKCE helpers (RFC 7636). The verifier is the per-login ephemeral secret that
 *  replaces a shipped client secret; the challenge is its SHA-256, base64url'd. */
import { randomBytes, createHash } from 'node:crypto'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A high-entropy code verifier (86 chars — within the 43–128 spec range). */
export function createVerifier(): string {
  return base64url(randomBytes(64))
}

/** S256 challenge for a verifier. */
export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** Opaque `state` value to bind the callback to this request (CSRF guard). */
export function createState(): string {
  return base64url(randomBytes(16))
}
