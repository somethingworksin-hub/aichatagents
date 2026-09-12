import * as admin from "firebase-admin";

/**
 * On Cloud Run this uses the service's default credentials automatically —
 * no key file needed. For local development, run:
 *   gcloud auth application-default login
 * (or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path).
 *
 * On a non-GCP host (Render, etc.) there's no ambient credential to detect,
 * so paste the full service account JSON (Firebase Console → Project
 * Settings → Service Accounts → Generate new private key) into
 * GOOGLE_APPLICATION_CREDENTIALS_JSON as a single-line env var instead.
 */
if (!admin.apps.length) {
  const inlineCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (inlineCredentials) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(inlineCredentials)) });
  } else {
    admin.initializeApp();
  }
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
