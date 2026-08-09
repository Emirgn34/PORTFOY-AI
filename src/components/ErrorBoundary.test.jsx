import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary.jsx';

function Boom() {
  throw new Error('PATLADI');
}

describe('ErrorBoundary', () => {
  it('hatasız içeriği olduğu gibi geçirir', () => {
    render(
      <ErrorBoundary>
        <p>içerik</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('içerik')).toBeInTheDocument();
  });

  // Bu sınır olmadan tek bir render hatası TÜM React ağacını unmount ediyor ve
  // kullanıcı bomboş beyaz ekran görüyordu (menü dahil).
  it('render hatasını yakalar ve okunur bir kart gösterir', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Bu sayfa açılırken bir hata oluştu/i)).toBeInTheDocument();
    expect(screen.getByText('PATLADI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sayfayı yenile/i })).toBeInTheDocument();
  });

  it('"Tekrar dene" sınırı sıfırlar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('PATLADI');
      return <p>düzeldi</p>;
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    );
    expect(screen.getByText('PATLADI')).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /Tekrar dene/i }));

    expect(screen.getByText('düzeldi')).toBeInTheDocument();
  });
});
