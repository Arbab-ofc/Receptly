export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/popup-blocked':
      return 'Unable to open Google sign-in. Please allow popups and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'This email already uses another sign-in method. Please sign in using that method.';
    case 'auth/network-request-failed':
      return 'Unable to connect. Check your internet connection and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment before trying again.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Email or password is incorrect.';
    case 'auth/email-already-in-use':
      return 'An account already exists for this email. Please sign in.';
    case 'auth/weak-password':
      return 'Please choose a stronger password.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/requires-recent-login':
      return 'Please sign out and sign back in, then try changing your password again.';
    case 'auth/provider-already-linked':
      return 'This account already uses that sign-in method.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/web-storage-unsupported':
      return 'Please allow browser storage to keep your sign-in session.';
    case 'auth/unauthorized-domain':
    case 'auth/operation-not-allowed':
      return 'Google sign-in is unavailable on this site. Please contact support or use email and password.';
    default:
      return 'Unable to complete this authentication request. Please try again.';
  }
}
