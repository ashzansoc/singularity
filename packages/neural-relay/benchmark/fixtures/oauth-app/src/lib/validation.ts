export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export function validateEmail(email: string): string {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError('email', `invalid email: ${email}`);
  }
  return email;
}

export function validateRequired(value: string, field: string): string {
  if (!value || !value.trim()) {
    throw new ValidationError(field, `${field} is required`);
  }
  return value;
}