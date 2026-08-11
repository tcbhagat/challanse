import { initializeApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, inMemoryPersistence, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from 'firebase/auth';
import { appCheckSiteKey, firebaseConfig } from './config';
const e2eMode = import.meta.env.VITE_E2E_MODE === 'true';
const app = e2eMode ? null : initializeApp(firebaseConfig());
const auth = app ? getAuth(app) : null;
const appCheck = app ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey()), isTokenAutoRefreshEnabled: true }) : null;
if (auth) void setPersistence(auth, inMemoryPersistence);

const e2eSessionKey = 'challanse-e2e-user';
let e2eUser: User | null = e2eMode && sessionStorage.getItem(e2eSessionKey)
  ? { email: sessionStorage.getItem(e2eSessionKey), emailVerified: true } as User
  : null;
const e2eListeners = new Set<(user: User | null) => void>();
function setE2eUser(email: string | null) {
  if (email) sessionStorage.setItem(e2eSessionKey, email);
  else sessionStorage.removeItem(e2eSessionKey);
  e2eUser = email ? { email, emailVerified: true } as User : null;
  e2eListeners.forEach((listener) => listener(e2eUser));
}

export function observeUser(callback: (user: User | null) => void) {
  if (e2eMode) { e2eListeners.add(callback); callback(e2eUser); return () => e2eListeners.delete(callback); }
  if (!auth) throw new Error('Firebase Authentication is unavailable.');
  return auth.onAuthStateChanged(callback);
}
export async function googleSignIn() { if (e2eMode) { setE2eUser('browser-test@example.com'); return; } if (!auth) throw new Error('Firebase Authentication is unavailable.'); await signInWithPopup(auth, new GoogleAuthProvider()); }
export async function emailSignIn(email: string, password: string) { if (e2eMode) { if (!password) throw new Error('Password is required.'); setE2eUser(email); return; } if (!auth) throw new Error('Firebase Authentication is unavailable.'); await signInWithEmailAndPassword(auth, email, password); }
export async function emailRegister(email: string, password: string) { if (e2eMode) { if (!password) throw new Error('Password is required.'); setE2eUser(email); return; } if (!auth) throw new Error('Firebase Authentication is unavailable.'); const credential = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(credential.user); }
export async function logout() { if (e2eMode) { setE2eUser(null); return; } if (!auth) throw new Error('Firebase Authentication is unavailable.'); await signOut(auth); }
export async function idToken() { if (e2eMode) return 'browser-test-id-token'; return auth?.currentUser?.getIdToken() ?? ''; }
export async function appCheckToken() { if (e2eMode) return 'browser-test-app-check-token'; if (!appCheck) throw new Error('Firebase App Check is unavailable.'); return (await getToken(appCheck)).token; }
export async function resetPassword(email: string) { if (e2eMode) return; if (!auth) throw new Error('Firebase Authentication is unavailable.'); await sendPasswordResetEmail(auth, email); }
