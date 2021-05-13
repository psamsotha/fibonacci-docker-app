import React from 'react';
import { Link } from 'react-router-dom'
import './OtherPage.css';


const OtherPage = () => {
  return (
    <div>
      <p>I'm some other page!</p>
      <div>
        <Link className="App-link" to="/">Go back home</Link>
      </div>
    </div>
  );
};

export default OtherPage;


