import React, { Component } from 'react';
import axios from 'axios';
import './Fib.css';


class Fib extends Component {
  state = {
    seenIndexes: [],
    values: {},
    index: ''
  };

  componentDidMount() {
    this.fetchValues();
    this.fetchIndexes();
  }

  async fetchValues() {
    const values = await axios.get('/api/values/current');
    this.setState({values: values.data});
  }

  async fetchIndexes() {
    const seenIndexes = await axios.get('/api/values/all');
    this.setState({ seenIndexes: seenIndexes.data });
  }

  handleSubmit = async (event) => {
    event.preventDefault();
    await axios.post('/api/values', {
      index: this.state.index
    });
    this.setState({ index: '' });
  }

  renderSeenIndexes() {
    return this.state.seenIndexes
      .map(({ number }) => number)
      .join(', ');
  }

  renderValues() {
    const entries = [];
    for (let key in this.state.values) {
      entries.push(
        <div key={key}>
          For index {key} I calculated {this.state.values[key]}
        </div>
      )
    }
    return entries;
  }

  render() {
    return (
      <div>
        <form onSubmit={this.handleSubmit}>
          <div className="input-label">
            <label htmlFor="index-input">Enter your index: </label>
          </div>
          <div className="index-form">
            <input id="index-input"
              value={this.state.index}
              onChange={event => this.setState({ index: event.target.value }) }/>
            <button>Submit</button>
          </div>
        </form>

        <h3>Indexes I have seen:</h3>
        <p>{this.renderSeenIndexes()}</p>

        <h3>Calculated values:</h3>
        <div>{this.renderValues()}</div>
      </div>
    );
  }
}

export default Fib;