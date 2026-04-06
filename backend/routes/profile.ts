import express from 'express';
import { prisma } from '../src/prisma.js';
import { authMiddleware, profileUpdateSchema } from '../src/lib/auth_shared.js';

const router = express.Router();

// Update Profile
router.put('/profile', authMiddleware, async (req: any, res: any) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    
    // Ensure we only update valid fields for safety
    const updateData: any = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.bio !== undefined) updateData.bio = data.bio;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.role !== undefined) updateData.role = data.role;

    const existingUser = await (prisma as any).user.findUnique({
      where: { id: req.user.id }
    });

    if (!existingUser) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    const updatedUser = await (prisma as any).user.update({
      where: { id: req.user.id },
      data: updateData
    });

    const { password, ...safeUser } = updatedUser;
    res.json({ success: true, user: safeUser });
  } catch (error: any) {
    console.error('Profile Update Error:', error);
    res.status(400).json({ error: error.message || 'Failed to update profile' });
  }
});

// Legacy Profile Patch (if still used by some components)
router.patch('/auth/profile', authMiddleware, async (req: any, res: any) => {
  try {
    const data = profileUpdateSchema.parse(req.body);
    const updatedUser = await (prisma as any).user.update({
      where: { id: req.user.id },
      data
    });
    const { password, ...safeUser } = updatedUser;
    res.json(safeUser);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
