export function passwordProblems(pw: string): string[] {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('The password must be at least 10 characters long.');
  if (/^\d+$/.test(pw)) problems.push('The password cannot be entirely numeric.');
  if (/^(password|church|jesus|welcome|qwerty|admin)/i.test(pw)) problems.push('The password is too common.');
  return problems;
}
