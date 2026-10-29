/**
 * Utility for parsing, extracting, and formatting 10-digit phone numbers
 * from contact fields (contact_number, site_contractor_architect_number, qc_builder_contact).
 */

export function extractPhoneNumbers(text?: string | null): string[] {
  if (!text) return [];
  const s = String(text).trim();
  if (!s || s === '-' || s === '--' || s.toLowerCase() === 'na' || s.toLowerCase() === 'nil' || s.toLowerCase() === 'none') {
    return [];
  }

  const numbers: string[] = [];

  // Match candidate Indian phone numbers (10 digits, typically starting with 6-9, optional +91, 91, or 0)
  // Handles formatted strings like "98439 65000", "98439-65000", "+91 9843965000", "09843965000"
  const mobileRegex = /(?:(?:\+91|91|0)[\s\-]?)?([6-9]\d{4}[\s\-]?\d{5}|[6-9]\d{9})/g;
  let match: RegExpExecArray | null;
  while ((match = mobileRegex.exec(s)) !== null) {
    const digits = match[1].replace(/\D/g, '');
    if (digits.length === 10 && !numbers.includes(digits)) {
      numbers.push(digits);
    }
  }

  // Fallback: match any generic 10-digit number sequence if no mobile format found
  if (numbers.length === 0) {
    const genericRegex = /(?:(?:\+91|91|0)[\s\-]?)?(\d{5}[\s\-]?\d{5}|\b\d{10}\b)/g;
    while ((match = genericRegex.exec(s)) !== null) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length === 10 && !numbers.includes(digits)) {
        numbers.push(digits);
      }
    }
  }

  return numbers;
}

/**
 * Extracts descriptive label text from contact fields (e.g. builder name or comments).
 * Example: "Might be part of Sirila Life Spaces, 98439 65000" -> "Might be part of Sirila Life Spaces"
 */
export function extractContactLabel(text?: string | null): string {
  if (!text) return '';
  let s = String(text);
  // Remove phone numbers and their prefixes (+91, 91, 0)
  s = s.replace(/(?:(?:\+91|91|0)[\s\-]?)?([6-9]\d{4}[\s\-]?\d{5}|[6-9]\d{9}|\b\d{10}\b)/g, '');
  // Clean up remaining punctuation, dashes, slashes, commas, and excess whitespace
  s = s.replace(/[,;|\-\/]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Formats a 10-digit phone number cleanly as "XXXXX XXXXX" for readable display.
 */
export function formatPhoneNumber(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) {
    return `${d.slice(0, 5)} ${d.slice(5)}`;
  }
  return phone;
}
