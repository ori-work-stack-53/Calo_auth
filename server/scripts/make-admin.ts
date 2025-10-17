import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from the project root .env file
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

// Also try to load from server/.env if it exists
dotenv.config();

console.log('📁 Environment loaded from:', envPath);
console.log('🔍 DATABASE_URL exists:', !!process.env.DATABASE_URL);

const prisma = new PrismaClient();

async function makeUserAdmin(email: string) {
  try {
    console.log(`🔧 Making user ${email} an admin...`);

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        user_id: true,
        email: true,
        name: true,
        is_admin: true,
        is_super_admin: true,
      }
    });

    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      process.exit(1);
    }

    console.log('📋 Current user status:');
    console.log(`   Name: ${user.name}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Is Admin: ${user.is_admin}`);
    console.log(`   Is Super Admin: ${user.is_super_admin}`);

    if (user.is_admin && user.is_super_admin) {
      console.log('✅ User is already a super admin');
      process.exit(0);
    }

    const updatedUser = await prisma.user.update({
      where: { email },
      data: {
        is_admin: true,
        is_super_admin: true,
      },
      select: {
        user_id: true,
        email: true,
        name: true,
        is_admin: true,
        is_super_admin: true,
      }
    });

    console.log('✅ User updated successfully!');
    console.log('📋 Updated user status:');
    console.log(`   Name: ${updatedUser.name}`);
    console.log(`   Email: ${updatedUser.email}`);
    console.log(`   Is Admin: ${updatedUser.is_admin}`);
    console.log(`   Is Super Admin: ${updatedUser.is_super_admin}`);

    console.log('\n🎉 Done! User can now access admin features.');
    console.log('⚠️  Please log out and log back in for changes to take effect.');
  } catch (error) {
    console.error('❌ Error making user admin:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.error('❌ Please provide an email address');
  console.error('Usage: npm run make-admin <email>');
  console.error('Example: npm run make-admin user@example.com');
  process.exit(1);
}

makeUserAdmin(email);
