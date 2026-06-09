/**
 * [FUNC-GMAIL-6] [NFR-GMAIL-2] Categorizes email as transactional or not based on subject.
 */
export class EmailClassifier {
  static isTransaction(subject: string): boolean {
    if (subject.toLowerCase().includes('otp')) {
      return false;
    }
    return true;
  }
}
