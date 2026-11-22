/**
 * Whether this document may use the camera at all. The web server allows it only for pages loaded
 * from a /presentation address (the Permissions-Policy header), and the policy is fixed when the
 * page loads, so moving to the media pages inside the app is not enough.
 */
export function cameraBlockedByPolicy() {
  if (typeof document === 'undefined') return false;
  const d = document as Document & { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } };
  const policy = d.permissionsPolicy || d.featurePolicy;
  try { return policy ? !policy.allowsFeature('camera') : false; } catch { return false; }
}
