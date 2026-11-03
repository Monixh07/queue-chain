import React, { useState } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const BookingPage = () => {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    service: ''
  });
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          serviceRequired: form.service,
          requestId: crypto.randomUUID(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Booking failed.');
      setMessage(`Booking successful! Token: ${result.dailyTokenNumber}`);
    } catch (err) {
      setMessage(err.message || 'Booking failed.');
    }
  };

  return (
    <div className="container">
      <h2>QueueChain Booking</h2>
      <form onSubmit={handleSubmit} className="booking-form">
        <input name="fullName" placeholder="Full Name" value={form.fullName} onChange={handleChange} required />
        <input name="phone" placeholder="Phone Number" value={form.phone} onChange={handleChange} required />
        <input name="email" placeholder="Email Address" value={form.email} onChange={handleChange} required />
        <input name="service" placeholder="Service Required" value={form.service} onChange={handleChange} required />
        <button type="submit">Book</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
};

export default BookingPage;
