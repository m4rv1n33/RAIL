import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const GUILD_ID = "1406616756113641522";

const teams = [
  {
    name: "Basic Staff",
    isManagement: false,
    roleIds: ["1406675931589902466"],
    escalationTeamId: "management"
  },
  {
    name: "Internal Affairs",
    isManagement: false,
    roleIds: ["1406648620484399247"],
    escalationTeamId: "management"
  },
  {
    name: "Management",
    isManagement: true,
    roleIds: ["1407413756971188346"],
    escalationTeamId: null
  }
];

const seed = async () => {
  try {
    console.log("🌱 Seeding teams...");

    // Create teams in order
    const createdTeams: Record<string, string> = {};

    for (const teamData of teams) {
      const { name, isManagement, roleIds, escalationTeamId } = teamData;

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
          isManagement,
          escalationTeamId: null // Will set after all teams created
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

    // Now set up escalation paths
    const basicStaff = await prisma.supportTeam.findFirst({
      where: { guildId: GUILD_ID, name: "Basic Staff" }
    });

    const internalAffairs = await prisma.supportTeam.findFirst({
      where: { guildId: GUILD_ID, name: "Internal Affairs" }
    });

    const management = await prisma.supportTeam.findFirst({
      where: { guildId: GUILD_ID, name: "Management" }
    });

    if (basicStaff && management) {
      await prisma.supportTeam.update({
        where: { id: basicStaff.id },
        data: { escalationTeamId: management.id }
      });
      console.log("✓ Set Basic Staff escalation to Management");
    }

    if (internalAffairs && management) {
      await prisma.supportTeam.update({
        where: { id: internalAffairs.id },
        data: { escalationTeamId: management.id }
      });
      console.log("✓ Set Internal Affairs escalation to Management");
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
