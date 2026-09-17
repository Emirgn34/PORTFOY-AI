import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPage from './AdminPage.jsx';
import { listUsers } from '../services/admin.js';

vi.mock('../services/admin.js', () => ({ listUsers: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn() }));
vi.mock('../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ user: { id: 'admin' } }) }));

const users = [
  { id: 'never', username: 'yeni', role: 'user', created_at: '2026-09-16T10:00:00Z', last_sign_in_at: null },
  { id: 'admin', username: 'yonetici', role: 'admin', created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-09-17T09:30:00Z' },
  { id: 'old', username: 'eski', role: 'user', created_at: '2026-01-02T00:00:00Z', last_sign_in_at: '2026-08-01T10:00:00Z' },
];

beforeEach(() => {
  listUsers.mockReset().mockResolvedValue(users);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-17T12:00:00Z'));
});

describe('yönetici giriş bilgileri', () => {
  it('Türkiye saatini, giriş yapmayanları ve kullanıcı özetini gösterir', async () => {
    render(<AdminPage />);
    await screen.findByText('yonetici');
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('yonetici');
    expect(rows[0]).toHaveTextContent('12:30');
    expect(rows[0].querySelector('time')).toHaveAttribute('datetime', '2026-09-17T09:30:00.000Z');
    expect(screen.getByText('Henüz giriş yapmadı')).toBeInTheDocument();
    expect(screen.getByText('Toplam kullanıcı').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Son 7 günde giriş yapan').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Hiç giriş yapmayan').nextElementSibling).toHaveTextContent('1');
    expect(within(rows[0]).queryByRole('button', { name: 'Sil' })).not.toBeInTheDocument();
  });

  it('yenileme başarısızsa mevcut listeyi korur ve eski bilgiyi gösterdiğini belirtir', async () => {
    render(<AdminPage />);
    await screen.findByText('yonetici');
    listUsers.mockRejectedValueOnce(new Error('Bağlantı kurulamadı'));
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Son alınan bilgiler gösteriliyor');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('Henüz kullanıcı yok.')).not.toBeInTheDocument();
  });

  it('ilk yükleme hatasını boş kullanıcı listesi olarak sunmaz', async () => {
    listUsers.mockRejectedValueOnce(new Error('Yetkisiz'));
    render(<AdminPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Yetkisiz');
    expect(screen.queryByText('Henüz kullanıcı yok.')).not.toBeInTheDocument();
    expect(screen.queryByText('Toplam kullanıcı')).not.toBeInTheDocument();
  });

  it('yenilemede güncel giriş zamanını alır ve sıralama seçimini uygular', async () => {
    render(<AdminPage />);
    await screen.findByText('yonetici');
    listUsers.mockResolvedValueOnce(users.map((u) => u.id === 'never' ? { ...u, last_sign_in_at: '2026-09-17T11:00:00Z' } : u));
    fireEvent.click(screen.getByRole('button', { name: 'Yenile' }));
    await waitFor(() => expect(screen.queryByText('Henüz giriş yapmadı')).not.toBeInTheDocument());
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('yeni');
    fireEvent.change(screen.getByLabelText('Kullanıcı sıralaması'), { target: { value: 'username' } });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('eski');
  });
});
