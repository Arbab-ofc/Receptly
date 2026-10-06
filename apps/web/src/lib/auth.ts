import { initializeApp, getApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  GoogleAuthProvider,
  signInWithPopup,
  setPersistence,
  browserLocalPersistence,
  type User,
} from 'firebase/auth';
import { create } from 'zustand';
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const authConfigured = !!(config.apiKey && config.projectId && config.appId);
export const auth = authConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(config))
  : null;
export const useAuth = create<{ user: User | null; ready: boolean }>(() => ({
  user: null,
  ready: !authConfigured,
}));
// Configure once, before observing or signing in; capture failures for the auth UI.
const persistenceReady = auth
  ? setPersistence(auth, browserLocalPersistence).then(
      () => null,
      (error: unknown) => error,
    )
  : Promise.resolve(null);
if (auth) {
  void persistenceReady.then(() => {
    onAuthStateChanged(auth!, (user) => useAuth.setState({ user, ready: true }));
  });
}
async function ensurePersistence() {
  const error = await persistenceReady;
  if (error) throw error;
}
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
let googlePending = false;
export async function loginWithGoogle() {
  if (!auth) throw new Error('Authentication needs Firebase configuration. See the setup guide.');
  if (googlePending) return;
  googlePending = true;
  try {
    await ensurePersistence();
    return await signInWithPopup(auth, googleProvider);
  } finally {
    googlePending = false;
  }
}
export async function login(email: string, password: string) {
  if (!auth) throw new Error('Authentication needs Firebase configuration. See the setup guide.');
  await ensurePersistence();
  return signInWithEmailAndPassword(auth, email, password);
}
export async function register(name: string, email: string, password: string) {
  if (!auth) throw new Error('Authentication needs Firebase configuration. See the setup guide.');
  await ensurePersistence();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(result.user, { displayName: name });
  return result;
}
export async function resetPassword(email: string) {
  if (!auth) throw new Error('Authentication needs Firebase configuration. See the setup guide.');
  await ensurePersistence();
  return sendPasswordResetEmail(auth, email.trim());
}
export async function changePassword(currentPassword: string, newPassword: string) {
  const user = auth?.currentUser;
  if (!user?.email) throw new Error('Sign in again before changing your password.');
  if (user.providerData.some(({ providerId }) => providerId === 'google.com')) {
    throw new Error('Google-linked accounts manage their password through Google.');
  }
  if (!user.providerData.some(({ providerId }) => providerId === 'password')) {
    throw new Error('This account does not use email and password sign-in.');
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}
export async function logout() {
  if (auth) await signOut(auth);
}
