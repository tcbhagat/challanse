export type FirebaseClientConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };
function required(name: string): string { const value = import.meta.env[name] as string | undefined; if (!value) throw new Error(`Missing ${name}`); return value; }
export function firebaseConfig(): FirebaseClientConfig { return { apiKey: required('VITE_FIREBASE_API_KEY'), authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'), projectId: required('VITE_FIREBASE_PROJECT_ID'), appId: required('VITE_FIREBASE_APP_ID') }; }
export function appCheckSiteKey(): string { return required('VITE_FIREBASE_APP_CHECK_SITE_KEY'); }
