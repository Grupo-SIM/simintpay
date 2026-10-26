import type { Role } from '@prisma/client';

export class AuthResponseUserDto {
  id!: string;
  name!: string;
  email!: string;
  role!: Role;
}

export class AuthResponseDto {
  accessToken!: string;
  refreshToken!: string;
  expiresIn!: number;
  user!: AuthResponseUserDto;
}
