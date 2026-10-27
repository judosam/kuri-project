/**
 * Form validation utilities for admin portal.
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
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

/**
 * Validates password length and format.
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
 * Validates text fields for length.
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
    return required ? `${fieldName} is required.` : null;
  }
  if (trimmed.length < minLength) {
    return `${fieldName} must be at least ${minLength} characters.`;
  }
  if (trimmed.length > maxLength) {
    return `${fieldName} cannot exceed ${maxLength} characters.`;
  }
  return null;
}

/**
 * Validates uploaded Excel file (size, format).
 */
export function validateExcelFile(file: File, maxSizeBytes = 50 * 1024 * 1024): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    return 'CSV is not supported. In Google Sheets: File → Download → Microsoft Excel (.xlsx).';
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
    return 'Please upload a Microsoft Excel (.xlsx or .xls) file.';
  }
  if (file.size === 0) {
    return 'The selected file is empty. Please select a valid Excel workbook.';
  }
  if (file.size > maxSizeBytes) {
    const mbLimit = Math.round(maxSizeBytes / (1024 * 1024));
    return `File exceeds the maximum limit of ${mbLimit} MB.`;
  }
  return null;
}
