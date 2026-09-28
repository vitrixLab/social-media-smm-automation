// prisma/seed.ts  
import bcrypt from 'bcryptjs';
import 'dotenv/config';

import prisma from '../src/lib/prisma';

async function main() {
  // Admin user — hash generated at seed time
  const adminEmail = 'admin@smmai.com';       // ← note: smmai, not ssmai
  const adminPassword = 'admin';              // the plain password you'll type at /login
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash, role: 'ADMIN' },
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
  });

  // ----------------------------------------------------------------
  // Clients — match every required field on the model
  // ----------------------------------------------------------------
  const clients = [
    {
      id: 'cl-001',
      name: 'Ada Reyes',
      company: 'Acme Corp',
      email: 'ada@acme.com',
      phone: '+1-555-0101',
      website: 'https://acme.com',
      industry: 'SaaS',
      status: 'ACTIVE' as const,
      approved: true,
      revenue: 12500,
      accountManager: 'Mia Chen',
      tags: ['enterprise', 'retainer'],
      notes: 'Quarterly review scheduled for March.',
      postCount: 42,
      lastPostAt: new Date('2024-01-15T10:00:00Z'),
    },
    {
      id: 'cl-002',
      name: 'Ben Okafor',
      company: 'Northwind Labs',
      email: 'ben@northwind.io',
      phone: '+1-555-0114',
      website: 'https://northwind.io',
      industry: 'Healthtech',
      status: 'PROSPECT' as const,
      approved: false,
      revenue: 0,
      accountManager: 'Diego Santos',
      tags: ['inbound', 'trial'],
      notes: 'Requested pricing sheet.',
      postCount: 0,
    },
    {
      id: 'cl-003',
      name: 'Cara Lin',
      company: 'Lumen & Co',
      email: 'cara@lumen.co',
      phone: '+1-555-0188',
      website: 'https://lumen.co',
      industry: 'Retail',
      status: 'PAUSED' as const,
      approved: true,
      revenue: 4800,
      accountManager: 'Mia Chen',
      tags: ['smb'],
      notes: 'Paused billing pending budget review.',
      postCount: 17,
      lastPostAt: new Date('2023-11-09T08:15:00Z'),
    },
  ];

  for (const c of clients) {
    await prisma.client.upsert({
      where: { id: c.id },
      update: {},
      create: c,
    });
  }

  // ----------------------------------------------------------------
  // Drafts — enum value is uppercase in the schema
  // ----------------------------------------------------------------
  await prisma.contentDraft.upsert({
    where: { id: 'draft-001' },
    update: {},
    create: {
      id: 'draft-001',
      topic: 'Welcome to SMMAI',
      platform: 'meta',
      text: 'Get started with social media management automation.',
      hashtags: ['#content', '#automation'],
      status: 'PUBLISHED',
      metadata: {},
      createdAt: new Date(),
      clientId: 'cl-001',
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => {
    await prisma.$disconnect();
  });