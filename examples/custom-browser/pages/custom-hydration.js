import React from 'react';
import ReactDOM from 'react-dom';
import TimeComponent from '../../basics/pages/time/TimeComponent';
import './style.css';

ReactDOM.hydrate(<TimeComponent/>, document.getElementById('time-hook'));

console.log('custom hydration');
