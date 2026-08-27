import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n';
import { TVChart } from '@/components/TVChart';
import React from 'react';

const mockStockData = [
  { date: '2024-01-01', open: 100, high: 105, low: 99, close: 102, volume: 1000000 },
  { date: '2024-01-02', open: 102, high: 108, low: 101, close: 106, volume: 1200000 },
  { date: '2024-01-03', open: 106, high: 110, low: 104, close: 108, volume: 900000 },
  { date: '2024-01-04', open: 108, high: 112, low: 106, close: 110, volume: 1100000 },
  { date: '2024-01-05', open: 110, high: 115, low: 108, close: 113, volume: 1300000 },
];

const mockSeries = {
  setData: vi.fn(),
  applyOptions: vi.fn(),
};

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn(() => ({
    addCandlestickSeries: vi.fn(() => mockSeries),
    addHistogramSeries: vi.fn(() => mockSeries),
    remove: vi.fn(),
    applyOptions: vi.fn(),
  })),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

describe('TVChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders without throwing', () => {
    const { container } = render(<TVChart data={mockStockData} symbol="AAPL" />, { wrapper });
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders chart container with correct dimensions', () => {
    render(<TVChart data={mockStockData} symbol="AAPL" />, { wrapper });
    const chartDiv = screen.getByTestId('tv-chart-container');
    expect(chartDiv).toHaveStyle('height: 500px');
    expect(chartDiv).toHaveClass('w-full');
  });

  it('displays symbol in title', () => {
    render(<TVChart data={mockStockData} symbol="AAPL" />, { wrapper });
    expect(screen.getByText((content) => content.includes('AAPL'))).toBeInTheDocument();
  });

  it('shows price change percentage', () => {
    render(<TVChart data={mockStockData} symbol="AAPL" />, { wrapper });
    expect(screen.getByText(/^\+?[\d.]+%$/)).toBeInTheDocument();
  });

  it('calls createChart with correct options', async () => {
    const { createChart } = await import('lightweight-charts');
    render(<TVChart data={mockStockData} symbol="AAPL" />, { wrapper });
    expect(createChart).toHaveBeenCalled();
  });
});