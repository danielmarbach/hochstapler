Feature: Removing a player from the lobby
  Taking a seat away from a person cannot be undone by the host alone, so the host confirms it.
  A bot can be replaced at any time and is removed at once.

  Scenario: Cancelling keeps the player at the table
    Given Anna has opened a game in Switzerland
    And Ben has joined Anna's game
    When Anna opens the lobby
    And Anna asks to remove Ben from the lobby
    Then Anna is asked to confirm removing Ben
    And the keyboard focus of Anna is on "Cancel removal"
    When Anna presses Escape
    Then Anna is no longer asked to confirm removing a player
    And the keyboard focus of Anna is on the remove button of Ben
    And the lobby for Anna still shows Ben

  Scenario: Confirming removes the player
    Given Anna has opened a game in Switzerland
    And Ben has joined Anna's game
    When Anna opens the lobby
    And Anna asks to remove Ben from the lobby
    And Anna confirms removing Ben
    Then the lobby for Anna no longer shows Ben

  Scenario: A bot is removed without asking
    When Anna creates a game in Switzerland with a bot on the start page
    And Anna removes the bot from the lobby
    Then the lobby for Anna shows no bot

  Scenario: The presence dot in the lobby names the state of each player
    Given Anna has opened a game in Switzerland
    And Ben has joined Anna's game
    When Anna opens the lobby
    Then the lobby for Anna shows that Ben is "online"
    When Ben closes the game page
    Then the lobby for Anna shows that Ben is "offline"
