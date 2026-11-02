import React, { useState } from 'react';
import axios from 'axios';

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
      const res = await axios.post('http://localhost:4000/api/bookings', {
        ...form,
        source: 'ONLINE'
      });
      setMessage(`Booking successful! Token: ${res.data.dailyTokenNumber}`);
    } catch (err) {
      setMessage('Booking failed');
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
