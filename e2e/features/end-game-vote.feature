Feature: Ending the game by vote
  Nobody has to play on until bankruptcy: whoever has had enough asks the others.
  If everyone agrees, the player with the greatest net worth (cash, properties and buildings) wins.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse"
    And it is Anna's turn

  Scenario: Ben agrees and the results page shows the ranking by net worth
    When Anna proposes ending the game
    Then Ben sees the request from Anna to end the game
    And Ben sees that Anna has already agreed
    When Ben agrees to end the game
    Then Anna sees that Anna wins the game
    And Ben sees that Anna wins the game
    And the results page for Ben shows Anna ahead of Ben
    And the results page for Ben shows Anna with a net worth of 2'100
    And the results page for Ben shows Ben with a net worth of 2'000
    And the results page for Anna offers a new game

  Scenario: Ben declines and the game continues
    When Anna proposes ending the game
    And Ben rejects ending the game
    Then the game continues for Anna
    And the game continues for Ben
    And Anna cannot propose ending the game again right away
