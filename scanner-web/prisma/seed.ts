import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const email = 'mr.mobile.conctacto@gmail.com';
    const password = 'Latidos2327';
    const passwordHash = await bcrypt.hash(password, 12);

    // 1. Create or find the initial user
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                name: 'Mr. Mobile',
            },
        });
        console.log(`✅ Created user: ${user.email} (ID: ${user.id})`);
    } else {
        console.log(`ℹ️  User already exists: ${user.email} (ID: ${user.id})`);
    }

    // 2. Migrate orphaned Products (userId is empty/null)
    const orphanedProducts = await prisma.product.findMany({
        where: { userId: '' },
    });

    if (orphanedProducts.length > 0) {
        await prisma.product.updateMany({
            where: { userId: '' },
            data: { userId: user.id },
        });
        console.log(`✅ Migrated ${orphanedProducts.length} products to user ${user.email}`);
    } else {
        console.log(`ℹ️  No orphaned products to migrate.`);
    }

    // 3. Migrate orphaned HistorySessions
    const orphanedSessions = await prisma.historySession.findMany({
        where: { userId: '' },
    });

    if (orphanedSessions.length > 0) {
        await prisma.historySession.updateMany({
            where: { userId: '' },
            data: { userId: user.id },
        });
        console.log(`✅ Migrated ${orphanedSessions.length} sessions to user ${user.email}`);
    } else {
        console.log(`ℹ️  No orphaned sessions to migrate.`);
    }

    console.log('\n🎉 Seed complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
