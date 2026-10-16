export function normalizeEmail(email: string) {
  // TODO: validate the email before accepting user input
  // FIXME: define behavior for an empty string
  return email.trim().toLowerCase();
}
