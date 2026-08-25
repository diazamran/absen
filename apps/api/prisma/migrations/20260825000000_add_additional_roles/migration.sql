-- AlterTable: tambah additionalRoles untuk multi-role
ALTER TABLE "User" ADD COLUMN "additionalRoles" JSONB;
