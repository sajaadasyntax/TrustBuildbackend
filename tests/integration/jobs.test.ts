/**
 * Integration tests for Jobs API
 */

import request from 'supertest';
import express from 'express';
import {
  prisma,
  createTestUser,
  createTestCustomer,
  createTestContractor,
  createTestJob,
  generateTestToken,
  integrationTestSetup,
} from './setup';

// Minimal Express app for testing
const app = express();
app.use(express.json());

// Mock authentication middleware
const authMiddleware = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const jwt = require('jsonwebtoken');
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Mock routes
app.get('/api/jobs', authMiddleware, async (req: any, res) => {
  const jobs = await prisma.job.findMany({
    include: {
      customer: { include: { user: true } },
      service: true,
    },
  });
  res.json(jobs);
});

app.post('/api/jobs', authMiddleware, async (req: any, res) => {
  const { title, description, budget, serviceId } = req.body;

  // Get customer for this user
  const customer = await prisma.customer.findUnique({
    where: { userId: req.user.userId },
  });

  if (!customer) {
    return res.status(400).json({ error: 'Customer profile required' });
  }

  const job = await prisma.job.create({
    data: {
      customerId: customer.id,
      title,
      description,
      budget,
      serviceId,
      status: 'OPEN',
    },
  });

  res.status(201).json(job);
});

app.get('/api/jobs/:id', authMiddleware, async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: {
      customer: { include: { user: true } },
      wonByContractor: { include: { user: true } },
      service: true,
    },
  });

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.patch('/api/jobs/:id/status', authMiddleware, async (req: any, res) => {
  const { status } = req.body;

  const job = await prisma.job.update({
    where: { id: req.params.id },
    data: { status },
  });

  res.json(job);
});

describe('Jobs API Integration Tests', () => {
  beforeAll(integrationTestSetup.beforeAll);
  beforeEach(integrationTestSetup.beforeEach);
  afterAll(integrationTestSetup.afterAll);

  let customerUser: any;
  let customerProfile: any;
  let contractorUser: any;
  let contractorProfile: any;
  let customerToken: string;
  let contractorToken: string;

  beforeEach(async () => {
    // Create test customer
    customerUser = await createTestUser({
      email: 'customer@test.com',
      password: 'password123',
      name: 'Test Customer',
      role: 'CUSTOMER',
    });
    customerProfile = await createTestCustomer(customerUser.id);
    customerToken = generateTestToken(customerUser.id, 'CUSTOMER');

    // Create test contractor
    contractorUser = await createTestUser({
      email: 'contractor@test.com',
      password: 'password123',
      name: 'Test Contractor',
      role: 'CONTRACTOR',
    });
    contractorProfile = await createTestContractor(contractorUser.id);
    contractorToken = generateTestToken(contractorUser.id, 'CONTRACTOR');
  });

  describe('POST /api/jobs', () => {
    it('should create a new job as customer', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          title: 'Plumbing Repair',
          description: 'Fix leaking pipe in bathroom',
          budget: 500,
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Plumbing Repair',
        budget: 500,
        status: 'OPEN',
      });

      // Verify job was created in database
      const job = await prisma.job.findFirst({
        where: { title: 'Plumbing Repair' },
      });
      expect(job).toBeTruthy();
      expect(job?.customerId).toBe(customerProfile.id);
    });

    it('should reject job creation without authentication', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .send({
          title: 'Test Job',
          description: 'Test',
          budget: 100,
        });

      expect(response.status).toBe(401);
    });

    it('should reject job creation by contractor without customer profile', async () => {
      // Contractor doesn't have customer profile
      const response = await request(app)
        .post('/api/jobs')
        .set('Authorization', `Bearer ${contractorToken}`)
        .send({
          title: 'Test Job',
          description: 'Test',
          budget: 100,
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/jobs', () => {
    beforeEach(async () => {
      // Create test jobs
      await createTestJob(customerProfile.id, {
        title: 'Job 1',
        status: 'OPEN',
      });
      await createTestJob(customerProfile.id, {
        title: 'Job 2',
        status: 'IN_PROGRESS',
      });
    });

    it('should list all jobs when authenticated', async () => {
      const response = await request(app)
        .get('/api/jobs')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/api/jobs');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/jobs/:id', () => {
    let testJob: any;

    beforeEach(async () => {
      testJob = await createTestJob(customerProfile.id, {
        title: 'Detailed Job',
        description: 'Job with details',
      });
    });

    it('should return job details', async () => {
      const response = await request(app)
        .get(`/api/jobs/${testJob.id}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: testJob.id,
        title: 'Detailed Job',
      });
      expect(response.body.customer).toBeTruthy();
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .get('/api/jobs/non-existent-id')
        .set('Authorization', `Bearer ${customerToken}`);

      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/jobs/:id/status', () => {
    let testJob: any;

    beforeEach(async () => {
      testJob = await createTestJob(customerProfile.id, {
        status: 'OPEN',
      });
    });

    it('should update job status', async () => {
      const response = await request(app)
        .patch(`/api/jobs/${testJob.id}/status`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ status: 'IN_PROGRESS' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('IN_PROGRESS');

      // Verify update in database
      const updatedJob = await prisma.job.findUnique({
        where: { id: testJob.id },
      });
      expect(updatedJob?.status).toBe('IN_PROGRESS');
    });
  });
});

