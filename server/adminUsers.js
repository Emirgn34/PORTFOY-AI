// Yalnızca sunucuda, yönetici yetkisi doğrulandıktan sonra çağrılır.
// Auth yanıtındaki e-posta, metadata ve diğer özel alanları istemciye taşımaz.
export async function listManagedUsers(sb) {
  const perPage = 200;
  const users = new Map();
  for (let page = 1; ; page += 1) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const authUsers = data.users;
    if (!authUsers.length) break;

    // Küçük gruplar profiles tablosunun varsayılan satır sınırına takılmaz.
    const { data: profiles, error: profileError } = await sb
      .from('profiles')
      .select('id, username, role, created_at')
      .in('id', authUsers.map((user) => user.id));
    if (profileError) throw profileError;
    const signIns = new Map(authUsers.map((user) => [user.id, user.last_sign_in_at ?? null]));
    for (const profile of profiles) {
      users.set(profile.id, {
        id: profile.id,
        username: profile.username,
        role: profile.role,
        created_at: profile.created_at,
        last_sign_in_at: signIns.get(profile.id),
      });
    }
    if (authUsers.length < perPage) break;
  }
  return [...users.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}
