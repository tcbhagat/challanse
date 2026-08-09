import { initializeApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, inMemoryPersistence, sendEmailVerification, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { appCheckSiteKey, firebaseConfig } from './config';
const app = initializeApp(firebaseConfig());
const auth = getAuth(app);
const appCheck = initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey()), isTokenAutoRefreshEnabled: true });
void setPersistence(auth, inMemoryPersistence);
export function observeUser(callback: Parameters<typeof auth.onAuthStateChanged>[0]) { return auth.onAuthStateChanged(callback); }
export async function googleSignIn() { return signInWithPopup(auth, new GoogleAuthProvider()); }
export async function emailSignIn(email: string, password: string) { return signInWithEmailAndPassword(auth, email, password); }
export async function emailRegister(email: string, password: string) { const credential = await createUserWithEmailAndPassword(auth, email, password); await sendEmailVerification(credential.user); return credential; }
export async function logout() { await signOut(auth); }
export async function idToken() { return auth.currentUser?.getIdToken() ?? ''; }
export async function appCheckToken() { return (await getToken(appCheck)).token; }
export async function resetPassword(email: string) { await sendPasswordResetEmail(auth, email); }
