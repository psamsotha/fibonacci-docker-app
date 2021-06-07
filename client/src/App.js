import logo from './logo.svg';
import { BrowserRouter as Router, Route, Link, Switch } from 'react-router-dom';
import './App.css';
import Fib from './Fib';
import OtherPage from './OtherPage';


function App() {
  return (
    <Router>
      <div className="App">
        <header className="App-header">
          <img src={logo} className="App-logo" alt="logo" />
          <h2>Fib Calculator</h2>
          <div>
            <Link className="App-link App-link-home" to="/">Home</Link>
            <Link className="App-link App-link-home" to="/otherpage">Other Page</Link>
          </div>
          <div className="App-routes">
            <Switch>
              <Route path="/otherpage"><OtherPage /></Route>
              <Route exact path="/"><Fib /></Route>
            </Switch>
          </div>
        </header>
      </div>
    </Router>
  );
}


export default App;
