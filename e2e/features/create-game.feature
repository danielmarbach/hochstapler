Feature: Creating a game and inviting friends
  A host creates a game, shares the invite link and starts as soon as everyone is there.

  Scenario: The host invites a guest by link and both see the board
    When Anna creates a game in Switzerland with a bot on the start page
    Then the lobby for Anna shows the host "Anna" and a bot
    When Anna copies the invite link
    And Ben opens the invite link and joins as "Ben"
    Then Anna sees the fellow player "Ben" in the lobby
    When Anna starts the game
    Then Anna and Ben see the board with 3 players

  Scenario: The country selection determines the game in the lobby
    When Anna creates a game in France with a bot on the start page
    Then the lobby for Anna shows the country "Frankreich"

  Scenario: Nobody gets into the game with a wrong invite code
    Given Anna has opened a game in Switzerland
    When Ben opens an invite link with a wrong code and joins as "Ben"
    Then Ben sees the error message "Falscher Einladungscode"

  Scenario: A full game is explained before anybody tries to join
    Given Anna has opened a game in Switzerland
    And Ben has joined Anna's game
    When Clara opens the invite link of Anna's game
    Then Clara is told that the game is full and cannot join

  Scenario: Joining without a name marks the field and announces the error
    Given Anna has opened a game in Switzerland
    When Ben opens the invite link of Anna's game
    And Ben submits the form without a name
    Then Ben sees the name field marked as invalid with the message

  Scenario: A lobby that cannot be loaded can be retried
    Given Anna has opened a game in Switzerland
    And the lobby cannot be loaded for Ben at first
    When Ben opens the invite link of Anna's game
    And Ben presses the Retry button
    Then Ben can join the game
