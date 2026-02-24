import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GUILD_ID = "1406616756113641522";

const teams = [
  {
    name: "Basic Staff",
    roleIds: ["1406675931589902466"]
  },
  {
    name: "Internal Affairs",
    roleIds: ["1406648620484399247"]
  }
];

const seed = async () => {
  try {
    console.log("🌱 Seeding teams...");

    // Create teams in order
    const createdTeams: Record<string, string> = {};

    for (const teamData of teams) {
      const { name, roleIds } = teamData;

      // Skip if team already exists
      const existing = await prisma.supportTeam.findFirst({
        where: { guildId: GUILD_ID, name }
      });

      if (existing) {
        console.log(`✓ Team "${name}" already exists`);
        createdTeams[name.toLowerCase()] = existing.id;
        continue;
      }

      // Create team
      const team = await prisma.supportTeam.create({
        data: {
          guildId: GUILD_ID,
          name,
          isManagement: false,
          escalationTeamId: null
        }
      });

      createdTeams[name.toLowerCase()] = team.id;

      // Create role associations
      for (const roleId of roleIds) {
        await prisma.supportTeamRole.create({
          data: {
            teamId: team.id,
            roleId
          }
        });
      }

      console.log(`✓ Created team "${name}" with roles: ${roleIds.join(", ")}`);
    }

    console.log("✅ Seeding complete!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

seed();
