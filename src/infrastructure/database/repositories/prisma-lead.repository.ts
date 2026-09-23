import { Injectable } from '@nestjs/common';
import { Lead, LeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ILeadRepository,
  CreateLeadData,
} from '../../../core/repositories/lead.repository.interface';

@Injectable()
export class PrismaLeadRepository implements ILeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateLeadData): Promise<Lead> {
    return this.prisma.lead.create({ data });
  }

  async findByEmailOrCnpj(email: string, cnpj: string): Promise<Lead | null> {
    return this.prisma.lead.findFirst({
      where: { OR: [{ email }, { cnpj }] },
    });
  }

  async findById(id: string): Promise<Lead | null> {
    return this.prisma.lead.findUnique({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<Lead[]> {
    return this.prisma.lead.findMany({ where: { id: { in: ids } } });
  }

  async list(query: {
    page: number;
    pageSize: number;
    status?: LeadStatus;
  }): Promise<{ data: Lead[]; total: number }> {
    const where = query.status ? { status: query.status } : {};
    const [total, data] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data, total };
  }

  async approve(id: string, approvedUserId: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { status: 'APPROVED', approvedUserId },
    });
  }

  async reject(id: string, reason?: string): Promise<Lead> {
    return this.prisma.lead.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason ?? null },
    });
  }

  async deleteMany(ids: string[]): Promise<number> {
    const result = await this.prisma.lead.deleteMany({
      where: { id: { in: ids }, status: { not: 'PENDING' } },
    });
    return result.count;
  }
}
