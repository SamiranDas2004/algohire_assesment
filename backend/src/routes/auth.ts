import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db';

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const userResult = await db.query(
    'SELECT id, email, name, role, password_hash, supervisor_id FROM users WHERE email = $1',
    [email]
  );
  const user = userResult.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  let zoneIds: string[] = [];
  if (user.role === 'operator') {
    const zones = await db.query(
      'SELECT zone_id FROM zone_assignments WHERE user_id = $1',
      [user.id]
    );
    zoneIds = zones.rows.map((r: { zone_id: string }) => r.zone_id);
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role, zoneIds },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '12h' }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, zoneIds } });
});
