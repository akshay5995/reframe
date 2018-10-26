import React from 'react';
import {endpoints, addRequestContext} from 'wildcard-api/client';
import assert from 'reassert';

export default {
  route: '/',
  view: MainPage,
  getInitialProps,
};

async function getInitialProps({requestContext, isBrowser}) {

  console.log(2);
  console.log(endpoints);
  console.log(endpoints['ii']);
  console.log(2.3);
  endpoints = {aaa:1};
  console.log(endpoints);
  console.log(3);
  if( requestContext ) {
    assert(!isBrowser);
    endpoints = addRequestContext(endpoints, requestContext);
  }

  const user = await endpoints.getLoggedUser({req});
  if( ! user ) {
    return null;
  }
  const todos = await endpoints.getTodos({req});
  return {todos, user};
}

function MainPage(props) {
  if( ! props.user ) {
    return Login(props);
  } else {
    return TodoList(props);
  }
}

function Todo(todo) {
  return (
    <div key={todo.id}>{todo.text}</div>
  );
}

function TodoList({todos, user}) {
  return (
    <div>
      Hi, <span>{user.username}</span>.
      <h1>Todos</h1>
      { todos.map(Todo) }
    </div>
  );
}

function Login() {
  return (
    <div style={{height: '80vh', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
      <a href='/auth/github'>Login with GitHub</a>
    </div>
  );
}
