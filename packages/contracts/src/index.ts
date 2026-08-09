import { z } from 'zod';

export const receiptStatuses = ['RECEIVED', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED'] as const;
export const receiptStatusSchema = z.enum(receiptStatuses);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const vendorSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  initials: z.string().min(1).max(3),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type Vendor = z.infer<typeof vendorSchema>;

export const receiptUploadMetadataSchema = z.object({
  receiptId: z.string().uuid(),
  vendorId: z.string().min(1).max(64),
  capturedAtUnix: z.number().int().positive(),
  capturedQuantity: z.number().int().positive().max(1_000_000),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  appVersion: z.string().min(1).max(32),
  configurationVersion: z.number().int().nonnegative(),
});
export type ReceiptUploadMetadata = z.infer<typeof receiptUploadMetadataSchema>;

export const uploadSessionRequestSchema = receiptUploadMetadataSchema.extend({
  totalBytes: z.number().int().positive().max(750_000),
  mimeType: z.literal('image/webp'),
});
export type UploadSessionRequest = z.infer<typeof uploadSessionRequestSchema>;

export const uploadPartSize = 256_000;

export const receiptReviewSchema = z.object({
  action: z.enum(['VERIFY', 'REJECT']),
  version: z.number().int().positive(),
  challanNumber: z.string().trim().max(120).default(''),
  poNumber: z.string().trim().min(1).max(120),
  materialCode: z.string().trim().min(1).max(120),
  materialDescription: z.string().trim().min(1).max(500),
  verifiedQuantity: z.number().positive().max(1_000_000_000),
  unit: z.string().trim().min(1).max(24),
  notes: z.string().trim().max(1000).default(''),
});
export type ReceiptReview = z.infer<typeof receiptReviewSchema>;

export const enrollmentRequestSchema = z.object({
  enrollmentCode: z.string().regex(/^[A-Z0-9]{8}$/),
  deviceName: z.string().trim().min(1).max(80),
  appVersion: z.string().min(1).max(32),
});

export const pilotRequestSchema = z.object({
  name: z.string().trim().min(2).max(100),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(24).default(''),
  message: z.string().trim().max(1000).default(''),
  turnstileToken: z.string().min(1).max(4096),
  website: z.string().max(0).default(''),
});

export type BootstrapResponse = {
  pilotMode: 'synthetic-demo' | 'controlled-client-pilot';
  site: { id: string; name: string };
  device: { id: string; name: string };
  vendors: Vendor[];
  allowedWifiSsids: string[];
  configurationVersion: number;
  limits: { dailyReceipts: number; imageBytes: number };
};

export type ReceiptListItem = {
  id: string;
  vendorId: string;
  vendorName: string;
  capturedAtUnix: number;
  capturedQuantity: number;
  status: ReceiptStatus;
  version: number;
  imageUrl: string | null;
  challanNumber: string;
  poNumber: string;
  materialCode: string;
  materialDescription: string;
  verifiedQuantity: number | null;
  unit: string;
  notes: string;
  enrichmentStatus: string;
  ocrConfidence: number | null;
  rawOcrJson: Record<string, unknown>;
  gstStatus: string;
};

export type ReconciliationRow = {
  poNumber: string;
  materialCode: string;
  unit: string;
  poQuantity: number;
  siteReceived: number;
  isOver: boolean;
};

export const invoiceStates = [
  'UPLOADING', 'PROCESSING', 'READY_TO_CONFIRM', 'COMPLETED', 'NEEDS_CORRECTION', 'DELETED',
] as const;
export const invoiceStateSchema = z.enum(invoiceStates);
export type InvoiceState = z.infer<typeof invoiceStateSchema>;

export const accountPlans = ['FREE', 'PAID', 'PAST_DUE', 'CANCEL_AT_PERIOD_END'] as const;
export const accountPlanSchema = z.enum(accountPlans);
export type AccountPlan = z.infer<typeof accountPlanSchema>;

export const invoiceUnits = ['BAG', 'KG', 'TON', 'NOS', 'LTR', 'M3', 'UNIT'] as const;
export const invoiceUnitSchema = z.enum(invoiceUnits);

export const invoiceFieldsSchema = z.object({
  vendor: z.string().trim().max(160).default(''),
  invoiceNumber: z.string().trim().max(120).default(''),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),
  material: z.string().trim().max(240).default(''),
  quantity: z.number().nonnegative().max(1_000_000_000).nullable(),
  unit: invoiceUnitSchema.nullable(),
});
export type InvoiceFields = z.infer<typeof invoiceFieldsSchema>;

export const createWebUploadSchema = z.object({
  filename: z.string().trim().min(1).max(180),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  totalBytes: z.number().int().positive().max(5_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type CreateWebUpload = z.infer<typeof createWebUploadSchema>;

export const confirmInvoiceSchema = invoiceFieldsSchema.extend({ version: z.number().int().positive() });
export type ConfirmInvoice = z.infer<typeof confirmInvoiceSchema>;
