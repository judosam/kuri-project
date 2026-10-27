/**
 * Form validation utilities for user-web (Field Operator App).
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates an email address.
 */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) {
    return 'Email address is required.';
  }
  // RFC 5322 compliant regex for standard email addresses
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address (e.g., user@example.com).';
  }
  return null;
}

/**
 * Validates password rules.
 */
export function validatePassword(password: string, minLength = 8): string | null {
  if (!password) {
    return 'Password is required.';
  }
  if (password.length < minLength) {
    return `Password must be at least ${minLength} characters long.`;
  }
  return null;
}

/**
 * Normalizes and validates Indian 10-digit mobile phone numbers.
 * Accepts formats: 9876543210, +91 98765 43210, 91-9876543210.
 */
export function validatePhone(phone: string, required = false): string | null {
  const trimmed = phone.trim();
  if (!trimmed) {
    return required ? 'Contact number is required.' : null;
  }

  // Strip spaces, hyphens, parentheses, and leading plus
  let cleaned = trimmed.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    return 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.';
  }
  return null;
}

/**
 * Clean phone to standardized 10-digit representation.
 */
export function cleanPhoneNumber(phone: string): string {
  let cleaned = phone.trim().replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  } else if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

/**
 * Validates date of visit (YYYY-MM-DD). Cannot be in the future.
 */
export function validateDateOfVisit(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) {
    return 'Date of visit is required.';
  }

  const parts = trimmed.split('-');
  if (parts.length !== 3) {
    return 'Date must be in YYYY-MM-DD format.';
  }

  const visitDate = new Date(`${trimmed}T00:00:00`);
  if (isNaN(visitDate.getTime())) {
    return 'Invalid date selected.';
  }

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (visitDate > today) {
    return 'Date of visit cannot be in the future.';
  }

  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 5);
  if (visitDate < minDate) {
    return 'Date of visit cannot be older than 5 years.';
  }

  return null;
}

/**
 * Validates text fields for minimum and maximum length.
 */
export function validateText(
  value: string,
  fieldName: string,
  minLength = 1,
  maxLength = 255,
  required = true
): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? `${fieldName} cannot be empty.` : null;
  }
  if (trimmed.length < minLength) {
    return `${fieldName} must be at least ${minLength} characters.`;
  }
  if (trimmed.length > maxLength) {
    return `${fieldName} cannot exceed ${maxLength} characters.`;
  }
  return null;
}
