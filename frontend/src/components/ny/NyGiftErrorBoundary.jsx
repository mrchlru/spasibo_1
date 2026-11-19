import React from 'react';

/**
 * Ловит падение экрана новогоднего подарка, чтобы не ронять всё приложение.
 */
class NyGiftErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      failed: true,
      message: error?.message || 'Не удалось открыть новогодний экран',
    };
  }

  componentDidCatch(error, info) {
    console.error('NewYearGiftPage crashed', error, info);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 80,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          background: '#0a2417',
          color: '#fff',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Что-то пошло не так</p>
        <p style={{ margin: 0, opacity: 0.8 }}>{this.state.message}</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ failed: false, message: '' });
            this.props.onBack?.();
          }}
          style={{
            border: 0,
            borderRadius: 30,
            padding: '14px 24px',
            fontWeight: 700,
            background: 'linear-gradient(#ffe28a, #ffb93d)',
            color: '#3a2a00',
            cursor: 'pointer',
          }}
        >
          Назад на главную
        </button>
      </div>
    );
  }
}

export default NyGiftErrorBoundary;
