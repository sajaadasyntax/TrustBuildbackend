/**
 * Integration test setup
 * Sets up test database and provides utilities for integration testing
 */

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    },
  },
});

/**
 * Clean up database before/after tests
 */
export async function cleanDatabase() {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ');

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  } catch (error) {
    console.log({ error });
  }
}

/**
 * Create test user
 */
export async function createTestUser(data: {
  email: string;
  password: string;
  name: string;
  role: 'CUSTOMER' | 'CONTRACTOR' | 'ADMIN';
}) {
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash(data.password, 10);

  return await prisma.user.create({
    data: {
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: data.role,
      emailVerified: true,
    },
  });
}

/**
 * Create test contractor
 */
export async function createTestContractor(userId: string, data?: Partial<any>) {
  return await prisma.contractor.create({
    data: {
      userId,
      businessName: data?.businessName || 'Test Contractor Ltd',
      status: data?.status || 'ACTIVE',
      creditsBalance: data?.creditsBalance || 10,
      hasFreeTrialPoint: data?.hasFreeTrialPoint ?? true,
      ...data,
    },
  });
}

/**
 * Create test customer
 */
export async function createTestCustomer(userId: string, data?: Partial<any>) {
  return await prisma.customer.create({
    data: {
      userId,
      ...data,
    },
  });
}

/**
 * Create test job
 */
export async function createTestJob(customerId: string, data?: Partial<any>) {
  return await prisma.job.create({
    data: {
      customerId,
      title: data?.title || 'Test Job',
      description: data?.description || 'Test job description',
      budget: data?.budget || 1000,
      status: data?.status || 'OPEN',
      ...data,
    },
  });
}

/**
 * Generate JWT token for testing
 */
export function generateTestToken(userId: string, role: string) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { userId, role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

/**
 * Setup and teardown hooks
 */
export const integrationTestSetup = {
  beforeAll: async () => {
    await prisma.$connect();
  },
  
  beforeEach: async () => {
    await cleanDatabase();
  },
  
  afterAll: async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  },
};

