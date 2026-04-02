export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  imageUrl: string;
  pairsPerBox: number;
  pricePerPair: number;
  totalBoxPrice: number;
  isAvailable: boolean;
  createdAt?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
