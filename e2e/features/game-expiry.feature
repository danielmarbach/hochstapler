Feature: Expired games
  Games without activity are deleted automatically after some time so that the database stays small.
  Whoever still has a link to the game afterwards gets a friendly explanation instead of an error.

  Background:
    Given Anna and Ben play a game in Switzerland

  Scenario: An open game expires while Anna still has it open
    When the game is deleted due to inactivity
    Then Anna sees the message that the game has expired or does not exist
    And Ben sees the message that the game has expired or does not exist
    And Anna no longer has a stored token for the game
    When Anna chooses the way back to the start page
    Then Anna sees the start page

  Scenario: Anna's link no longer works after expiry but is explained
    When the game is deleted due to inactivity
    And Anna opens her game link again
    Then Anna sees the message that the game has expired or does not exist
    And Anna no longer has a stored token for the game

  Scenario: A link to a game that does not exist
    When someone opens "#/game/gibtsnicht" on the phone
    Then the phone shows the message that the game has expired or does not exist
