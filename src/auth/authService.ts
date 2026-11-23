// Auth seam. DEMO IMPLEMENTATION ONLY: it accepts any credentials and verifies nothing.
// To add real authentication, implement `AuthService` against your identity provider and swap `authService`;
// the store, route guard and pages do not change. Passwords are never stored or kept after the call returns.

export interface Session {
  /** Stable id used to isolate per-user settings (lowercased identifier in demo mode). */
  userId: string;
  name: string;
  identifier: string;
  mode: 'demo';
}

export interface AuthService {
  signIn(identifier: string, password: string): Promise<Session>;
  signUp(name: string, identifier: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
}

const toSession = (name: string, identifier: string): Session => {
  const id = identifier.trim();
  return { userId: id.toLowerCase().replace(/[^a-z0-9._@+-]/g, '_').slice(0, 120) || 'demo', name: name.trim() || id, identifier: id, mode: 'demo' };
};

export const demoAuthService: AuthService = {
  async signIn(identifier, _password) { return toSession(identifier.split('@')[0] ?? identifier, identifier); },
  async signUp(name, identifier, _password) { return toSession(name, identifier); },
  async signOut() { /* nothing server-side in demo mode */ },
};

export const authService: AuthService = demoAuthService;
