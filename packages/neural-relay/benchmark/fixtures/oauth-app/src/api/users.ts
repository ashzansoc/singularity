export interface User {
  id: string;
  email: string;
}

const users: User[] = [{ id: '1', email: 'demo@example.com' }];

export function listUsers(): User[] {
  return users;
}

export function createUser(email: string): User {
  const user = { id: String(users.length + 1), email };
  users.push(user);
  return user;
}
