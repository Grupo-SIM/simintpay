export type PageState =
  | 'polling'
  | 'success'
  | 'timeout'
  | 'already_delivered'
  | 'regenerated'
  | 'error';

export interface InviteLinkData {
  inviteLink: string;
  groupName: string;
  groupPageId: string;
}

export interface ApiError {
  status: number;
  message: string;
}

export interface PurchaseDetails {
  planName: string | null;
  planValue: number | null;
  planFrequency: string | null;
  planDays: number | null;
  isActive: boolean;
  paymentMethod: string;
  purchaseDate: string | null;
  customerEmail: string | null;
}
